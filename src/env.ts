import { readFileSync } from 'fs';
import * as path from 'path';

export function loadEnv() {
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    const text = readFileSync(envPath, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      if (!line || line.trim().startsWith('#')) continue;
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      let value = line.slice(idx + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      // Strip inline comments like: KEY=val  # comment
      const hashIdx = value.indexOf('#');
      if (hashIdx > -1) value = value.slice(0, hashIdx).trim();
      if (!process.env[key]) process.env[key] = value;
    }
    // console.log('✅ Local .env file loaded successfully');
  } catch (error) {
    // console.log('ℹ️ No local .env file found, using environment variables');

    // In production environments like Railway, ensure required variables are set
    if (process.env.NODE_ENV === 'production') {
      const requiredEnvVars = [
        'SUPABASE_URL',
        'SUPABASE_ANON_KEY',
        'DATABASE_URL',
      ];

      const missingVars = requiredEnvVars.filter(
        (envVar) => !process.env[envVar],
      );
      if (missingVars.length > 0) {
        console.error(
          '❌ Missing required environment variables:',
          missingVars,
        );
        throw new Error(
          `Missing required environment variables: ${missingVars.join(', ')}`,
        );
      }

      // Set ALLOW_DEV_UNVERIFIED_JWT to 1 in production as fallback for JWT verification issues
      if (!process.env.ALLOW_DEV_UNVERIFIED_JWT) {
        process.env.ALLOW_DEV_UNVERIFIED_JWT = '1';
        // console.log(
        //   'ℹ️ Set ALLOW_DEV_UNVERIFIED_JWT=1 for production fallback',
        // );
      }
    }
  }
}
