import { RuleTester as EslintRuleTester } from 'eslint';
import { describe, it } from 'node:test';

/* pattern taken from eslint-plugin-import */
export function addFilenameOption (testCase) {
  return {
    ...testCase,
    // TODO:  Find a way to remove this.
    filename: new URL('./files/foo.js', import.meta.url).pathname,
  };
}

/**
 * Customizing ESLint rule tester to be run by Mocha.
 * @see https://eslint.org/docs/latest/integrate/nodejs-api#customizing-ruletester
 */
EslintRuleTester.describe = describe;
EslintRuleTester.it = it;

export function RuleTester () {
  return new EslintRuleTester({
    parserOptions: {
      sourceType: 'module',
      ecmaVersion: 6,
      ecmaFeatures: { jsx: true },
    },
  });
};
