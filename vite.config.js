import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le proxy /api/kie neutralise le CORS en developpement : le navigateur parle a
// Vite (meme origine), Vite parle a api.kie.ai. Voir src/api/kie.js pour le
// choix d'URL de base entre dev et build.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api/kie': {
        target: 'https://api.kie.ai',
        changeOrigin: true,
        secure: true,
        rewrite: (path) => path.replace(/^\/api\/kie/, ''),
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.{js,jsx}'],
    // Les workers paralleles expiraient par intermittence au demarrage et des
    // fichiers entiers etaient silencieusement omis du total. Une suite qui
    // ment sur son perimetre est pire qu'une suite lente.
    fileParallelism: false,
  },
});
