import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages project site: https://USER.github.io/abb-live-interaction/
export default defineConfig({
  plugins: [react()],
  base: '/abb-live-interaction/'
});
