export default function setup() {
  process.env.NODE_ENV = 'test';
  process.env.ADMIN_API_KEY = 'test-key-for-jest';
  process.env.DATA_FILE = 'test-data.json';
}
