# PURE beauty room: сайт и админка для Netlify

- **Сайт:** главная страница `/`.
- **Админка:** `/admin`. Роли «админ» и «мастер».
- **Сервер:** Netlify Functions (`netlify/functions/api.mjs`).
- **База и загруженные фото:** Netlify Blobs. Отдельная база данных не нужна, на бесплатном тарифе всё работает.

## Как залить на Netlify (через GitHub, без командной строки)

1. **GitHub.** Зайдите на github.com, нажмите New repository (можно Private), назовите, например, `pure-site` и нажмите Create. На странице репозитория выберите «uploading an existing file» и перетащите **всё содержимое** этой папки: `netlify`, `public`, `netlify.toml`, `package.json`, `package-lock.json`, `README.md`, `.gitignore`. Папку `node_modules` загружать не нужно. Нажмите Commit changes.
2. **Netlify.** Откройте app.netlify.com, выберите Add new project → Import an existing project → GitHub, найдите репозиторий `pure-site`. Настройки сборки подтянутся из `netlify.toml` сами: Build command оставьте пустым, Publish directory будет `public`.
3. **Пароль админа.** Перед первым деплоем, в том же окне или потом в Project configuration → Environment variables, добавьте переменную **`ADMIN_PASSWORD`** и укажите пароль админа (не меньше 6 символов). Нажмите Deploy.
4. Если переменную добавили после деплоя, откройте Deploys → Trigger deploy → Deploy project.
5. Откройте `https://ВАШ-САЙТ.netlify.app/admin` и войдите: логин `admin`, пароль из `ADMIN_PASSWORD`.

После входа:
- В разделе «Доступи» создайте логины мастерам и привяжите каждого к мастеру на сайте.
- В разделе «Налаштування» проверьте контакты и график работы. Там же можно подключить Telegram: токен бота от @BotFather и свой chat id (его показывает @userinfobot). Кнопка «Надіслати тест» проверит, что уведомления доходят.
- Смените пароль: «Змінити пароль» внизу меню. После этого переменная `ADMIN_PASSWORD` больше не используется.

**Свой домен:** Domain management → Add a domain.

**Обновления:** меняете файлы в GitHub, и Netlify пересобирает сайт сам. Данные (заявки, цены, фото из админки) хранятся в Netlify Blobs и при обновлении сайта не теряются.

## Альтернатива: Netlify CLI

```bash
npm install
npm install -g netlify-cli
netlify login
netlify init        # создать или привязать сайт
netlify env:set ADMIN_PASSWORD 'ваш_пароль'
netlify deploy --prod
```

Просто перетащить папку в Netlify Drop не получится: при таком способе серверные функции не собираются, и запись и админка работать не будут.

## Структура

```
public/              статический сайт: index.html, admin.html, img/, uploads/seed-*.jpg (стартовые фото)
netlify/functions/   api.mjs → /api/*, uploads.mjs → /uploads/* (фото, загруженные через админку)
netlify/lib/         общая логика (core.mjs) и стартовые данные (seed.mjs)
netlify.toml         настройки Netlify
```

## Что уточнить у салона

- График работы.
- Цену наращивания ресниц.
- Специализации мастеров и их фото.
- Точный адрес после переезда.
- Разрешение использовать фото из их Instagram.
