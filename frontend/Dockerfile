FROM nginx:alpine
COPY *.html /usr/share/nginx/html/
COPY *.js /usr/share/nginx/html/
COPY shared.css /usr/share/nginx/html/shared.css
COPY manifest.webmanifest /usr/share/nginx/html/manifest.webmanifest
COPY icon.svg /usr/share/nginx/html/icon.svg
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
