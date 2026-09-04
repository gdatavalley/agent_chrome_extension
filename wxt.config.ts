import { defineConfig } from 'wxt';

// Milestone 0 spike manifest. host_permissions for localhost are spike-only —
// the production manifest keeps host_permissions empty and grants per-site at
// runtime (spec §6.1).
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    name: 'Browser Agent — M0 Spike',
    description: 'Milestone 0 debugger-pipeline spike. Not for distribution.',
    permissions: ['debugger', 'tabs', 'scripting', 'storage'],
    host_permissions: ['http://localhost/*'],
  },
});
