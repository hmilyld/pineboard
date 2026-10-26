export type Env = {
  DB: D1Database;
  BUCKET: R2Bucket;
  ASSETS: Fetcher;
  SITE_URL: string;
  CDN_URL: string;
  ENVIRONMENT: string;
  R2_BUCKET_NAME: string;
  BETTER_AUTH_SECRET: string;
  PASSWORD_PEPPER: string;
  TEST_OAUTH_CLIENT_SECRET: string;
  CF_ACCOUNT_ID: string;
  R2_ACCESS_KEY_ID: string;
  R2_SECRET_ACCESS_KEY: string;
};
