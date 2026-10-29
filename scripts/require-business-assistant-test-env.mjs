const value = process.env.BUSINESS_ASSISTANT_TEST_DATABASE_URL;
if (!value) {
  throw new Error('BUSINESS_ASSISTANT_TEST_DATABASE_URL must name an isolated disposable PostgreSQL database.');
}
if (process.env.DATABASE_URL !== value) {
  throw new Error('DATABASE_URL and BUSINESS_ASSISTANT_TEST_DATABASE_URL must be set to the same disposable database before starting the test process.');
}
const url = new URL(value);
if (!['postgres:', 'postgresql:'].includes(url.protocol) || !/(?:^|[_-])test(?:[_-]|$)/i.test(url.pathname.slice(1))) {
  throw new Error('Assistant integration tests require a PostgreSQL database whose name contains a separate test segment.');
}
if (['5433', '3000'].includes(url.port) || url.pathname === '/oakcloud') {
  throw new Error('The application database cannot be used for assistant integration tests.');
}
console.info('Dedicated Business Assistant test database guard passed.');
