// Resolve the app's aliases while running TypeScript with Node's built-in test runner.
import { registerHooks } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === '@core') return nextResolve(new URL('../../src/xml_wizard/designer_app/core.js', import.meta.url).href, context);
    if (specifier.startsWith('@/')) specifier = new URL('../src/' + specifier.slice(2) + '.ts', import.meta.url).href;
    if (specifier.startsWith('.') && context.parentURL) {
      const url = new URL(specifier + '.ts', context.parentURL);
      if (existsSync(fileURLToPath(url))) specifier = url.href;
    }
    return nextResolve(specifier, context);
  },
});
