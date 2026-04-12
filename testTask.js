require('dotenv').config();

const url = 'https://fefbzgmvlcxkaarxttlu.supabase.co/functions/v1/test-insert-task';
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

async function main() {
  if (!anonKey) {
    throw new Error('NEXT_PUBLIC_SUPABASE_ANON_KEY is not set');
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: anonKey,
      Authorization: `Bearer ${anonKey}`,
    },
    body: JSON.stringify({
      deal_id: '26032600-0000-4000-8000-000000000001',
    }),
  });

  const responseBody = await response.text();

  console.log('Status:', response.status);
  console.log('Response body:', responseBody);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
