import { defineConfig } from 'vite';
export default defineConfig({ clearScreen:false, server:{ port:1420, strictPort:true, host:'127.0.0.1' }, envPrefix:['VITE_','TAURI_'], build:{ target:'es2021', minify:!process.env.TAURI_DEBUG, sourcemap:!!process.env.TAURI_DEBUG } });
