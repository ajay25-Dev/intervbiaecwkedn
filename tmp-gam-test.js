const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url');
const payload = Buffer.from(JSON.stringify({ sub: 'dev-user', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
const token = `${header}.${payload}.`;
fetch('http://localhost:8080/api/gamification/lecture-complete', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({ lectureId: 'test-lecture' }),
})
  .then(async (res) => {
    const text = await res.text();
    console.log('STATUS', res.status);
    console.log('BODY', text);
  })
  .catch((err) => console.error('fetch error', err));
