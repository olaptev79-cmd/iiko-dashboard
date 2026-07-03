FROM nginx:alpine
COPY *.html /usr/share/nginx/html/
COPY shared.css /usr/share/nginx/html/shared.css
COPY shared.js /usr/share/nginx/html/shared.js
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
