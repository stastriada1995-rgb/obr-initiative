# Трекер инициативы для Owlbear Rodeo

Инициатива, действие / бонусное действие / реакция, навыки и ресурсы, состояния D&D 5e,
хиты и КД с полоской над токеном. Мастер видит всё; игроки — только порядок ходов,
имена, состояния и номер раунда.

## Публикация на GitHub Pages

Адрес расширения будет таким: `https://<логин>.github.io/<репозиторий>/manifest.json`.
Пути внутри сборки подставляются автоматически из имени репозитория.

1. Создайте на GitHub новый **публичный** репозиторий, например `obr-initiative`.
2. Загрузите в него содержимое этой папки **кроме** `node_modules` и `dist`:
   на странице репозитория **Add file → Upload files**, перетащите файлы и папки
   (`src`, `public`, `.github`, `index.html`, `skills.html`, `background.html`,
   `manifest.template.json`, `package.json`, `package-lock.json`, `vite.config.js`, `README.md`),
   затем **Commit changes**.
   Если папка `.github` не загрузилась (на Windows её бывает не видно), создайте файл вручную:
   **Add file → Create new file**, имя `.github/workflows/deploy.yml`, вставьте содержимое
   одноимённого файла из архива.
3. **Settings → Pages → Build and deployment → Source: GitHub Actions.**
4. Откройте вкладку **Actions**: сборка запускается сама после каждой загрузки файлов
   (или вручную: *Deploy to GitHub Pages → Run workflow*). Через 1–2 минуты появится зелёная галочка.
5. Проверьте в браузере `https://<логин>.github.io/<репозиторий>/manifest.json`.
6. Owlbear Rodeo → профиль → **Extensions → Add Custom Extension** → вставьте этот адрес.

Обновление: загрузите изменённые файлы в репозиторий — GitHub сам пересоберёт и опубликует.

## Локальная разработка

```
npm install
npm run dev
```
Адрес для Owlbear: `http://localhost:5173/obr-initiative/manifest.json`.
Для другого имени репозитория: `BASE=/имя/ npm run build`.
