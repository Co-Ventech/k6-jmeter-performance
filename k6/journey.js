import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Counter, Rate } from 'k6/metrics';
import { BASE_URL, ENDPOINTS } from './config.js';

const byName = {};
for (const ep of ENDPOINTS) {
  byName[ep.name] = {
    lat: new Trend(`lat_${ep.key}`, true),
    n: new Counter(`n_${ep.key}`),
    fail: new Rate(`fail_${ep.key}`),
  };
}

function observe(name, res) {
  const m = byName[name];
  if (m) {
    m.lat.add(res.timings.duration);
    m.n.add(1);
    m.fail.add(res.status >= 400 || res.status === 0);
  }
  return res;
}

function jsonHeaders(token) {
  const headers = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return { headers, tags: {} };
}

function uniqueAccount() {
  const stamp = `${Date.now()}-${__VU}-${__ITER}-${Math.floor(Math.random() * 1_000_000)}`;
  return {
    email: `qa.perf.${stamp}@example.com`,
    password: `Hyb!${stamp}Qa#9`,
  };
}

export default function authenticatedJourney() {
  const account = uniqueAccount();
  const registerBody = JSON.stringify({
    first_name: 'Perf',
    last_name: 'Tester',
    email: account.email,
    password: account.password,
    dob: '1990-01-15',
    phone: '5550100123',
    address: {
      street: 'Test Street',
      house_number: '12',
      city: 'Utrecht',
      state: 'UT',
      country: 'NL',
      postal_code: '3511AB',
    },
  });

  const register = observe(
    'POST /users/register',
    http.post(`${BASE_URL}/users/register`, registerBody, {
      headers: jsonHeaders().headers,
      tags: { name: 'POST /users/register' },
    }),
  );
  const registered = check(register, {
    'register 201': (r) => r.status === 201,
  });
  if (!registered) {
    sleep(1);
    return;
  }

  const login = observe(
    'POST /users/login',
    http.post(
      `${BASE_URL}/users/login`,
      JSON.stringify({ email: account.email, password: account.password }),
      { headers: jsonHeaders().headers, tags: { name: 'POST /users/login' } },
    ),
  );
  const token = login.json('access_token');
  const loggedIn = check(login, {
    'login 200': (r) => r.status === 200,
    'login has token': () => typeof token === 'string' && token.length > 0,
  });
  if (!loggedIn) {
    sleep(1);
    return;
  }

  const auth = jsonHeaders(token).headers;

  const list = observe(
    'GET /products',
    http.get(`${BASE_URL}/products?page=1`, {
      headers: auth,
      tags: { name: 'GET /products' },
    }),
  );
  const listOk = check(list, {
    'catalog 200': (r) => r.status === 200,
    'catalog has products': (r) => {
      try {
        return Array.isArray(r.json('data')) && r.json('data').length > 0;
      } catch (e) {
        return false;
      }
    },
  });
  if (!listOk) {
    sleep(1);
    return;
  }

  const products = list.json('data');
  const inStock = products.find((item) => item.in_stock) || products[0];
  const productId = inStock.id;

  const created = observe(
    'POST /carts',
    http.post(`${BASE_URL}/carts`, JSON.stringify({}), {
      headers: auth,
      tags: { name: 'POST /carts' },
    }),
  );
  const cartId = created.json('id');
  const cartOk = check(created, {
    'create cart 201': (r) => r.status === 201,
    'cart has id': () => typeof cartId === 'string' && cartId.length > 0,
  });
  if (!cartOk) {
    sleep(1);
    return;
  }

  const added = observe(
    'POST /carts/:id',
    http.post(
      `${BASE_URL}/carts/${cartId}`,
      JSON.stringify({ product_id: productId, quantity: 1 }),
      { headers: auth, tags: { name: 'POST /carts/:id' } },
    ),
  );
  check(added, {
    'add item 200': (r) => r.status === 200 || r.status === 201,
  });

  const cart = observe(
    'GET /carts/:id',
    http.get(`${BASE_URL}/carts/${cartId}`, {
      headers: auth,
      tags: { name: 'GET /carts/:id' },
    }),
  );
  check(cart, {
    'get cart 200': (r) => r.status === 200,
    'cart has the item': (r) => {
      try {
        return r.json('cart_items.0.product_id') === productId;
      } catch (e) {
        return false;
      }
    },
  });

  const deleted = observe(
    'DELETE /carts/:id',
    http.del(`${BASE_URL}/carts/${cartId}`, null, {
      headers: auth,
      tags: { name: 'DELETE /carts/:id' },
    }),
  );
  check(deleted, {
    'delete cart 200/204': (r) => r.status === 200 || r.status === 204,
  });

  sleep(1);
}
