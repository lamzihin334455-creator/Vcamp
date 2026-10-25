import {defineConfig} from '@playwright/test';
export default defineConfig({testDir:'tests/release',workers:1,timeout:90000,outputDir:'.tmp/package-results',reporter:[['list']],use:{trace:'off'}});
