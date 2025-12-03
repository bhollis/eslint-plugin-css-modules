import fs from 'node:fs';
import rules from './rules';

const pkg = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
);

const plugin = {
  meta: {
    name: pkg.name,
    version: pkg.version,
    namespace: 'css-modules',
  },
  configs: {},
  rules,
};

Object.assign(plugin.configs, {
  recommended: [
    {
      plugins: {
        'css-modules': plugin,
      },
      rules: {
        'css-modules/no-unused-class': 2, // error
        'css-modules/no-undef-class': 2, // error
      },
    },
  ],
});

export default plugin;
