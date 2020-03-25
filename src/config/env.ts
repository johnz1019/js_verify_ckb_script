import { resolve } from 'path';

import { config } from 'dotenv';

if (process.env.NODE_ENV === 'aggron') {
  config({ path: resolve(__dirname, '../../.env.aggron') });
} else {
  config({ path: resolve(__dirname, '../../.env') });
}
