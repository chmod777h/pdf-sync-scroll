import obsidian from 'eslint-plugin-obsidianmd';

export default [
  ...obsidian.configs.recommended,
  {
    files: ['main.js'],
    languageOptions: { sourceType: 'commonjs' },
    // Obsidian loads this readable JavaScript file as a CommonJS module.
    // Top-level declarations are module-local; require('obsidian') is its host import.
    rules: { '@typescript-eslint/no-require-imports': 'off', 'no-implicit-globals': 'off' },
  },
];
