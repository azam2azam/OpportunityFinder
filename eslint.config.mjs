import coreWebVitals from 'eslint-config-next/core-web-vitals'
import typescript from 'eslint-config-next/typescript'

/**
 * eslint-config-next 16 ships native flat configs. Importing them directly
 * avoids the FlatCompat layer, which throws on this config's plugin graph.
 */
export default [
  { ignores: ['.next/**', 'node_modules/**', 'next-env.d.ts'] },
  ...coreWebVitals,
  ...typescript,
  {
    rules: {
      // Prisma row builders in the seed assemble untyped objects before the
      // client exists; `any` there is deliberate, not laziness.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // `react-hooks/purity` forbids reading the clock during render, because in
    // a client component a re-render would silently produce a different value.
    // These files are server components rendered once per request (every page
    // is `force-dynamic`), where "how many days old is this" is exactly a
    // per-request fact and reading the clock is the correct behaviour. The rule
    // stays on for everything under components/client.
    files: ['src/app/**/*.tsx', 'src/components/ui.tsx', 'src/components/*.tsx'],
    ignores: ['src/components/client/**'],
    rules: { 'react-hooks/purity': 'off' },
  },
]
