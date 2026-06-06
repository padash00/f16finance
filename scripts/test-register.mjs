// Регистрирует resolve-hook для тестов (node --import ./scripts/test-register.mjs).
import { register } from 'node:module'
register('./test-loader.mjs', import.meta.url)
