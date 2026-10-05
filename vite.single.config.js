// Wersja jednoplikowa: cala gra (kod, dane torow, style) w jednym dist-single/index.html.
// Mozna ja otworzyc bezposrednio z dysku (file://) bez serwera.
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  base: './',
  plugins: [viteSingleFile()],
  build: {
    target: 'es2020',
    outDir: 'dist-single',
    chunkSizeWarningLimit: 4000,
  },
});
