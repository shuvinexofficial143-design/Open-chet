// Do not cache authenticated messages, API responses, or customer records.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{if(event.request.mode==='navigate')event.respondWith(fetch(event.request).catch(()=>new Response('<h1>Open Chet is offline</h1><p>Reconnect to securely load your inbox.</p>',{headers:{'Content-Type':'text/html'}})))});
self.addEventListener('push',event=>{const data=event.data?.json()||{};event.waitUntil(self.registration.showNotification('Open Chet',{body:data.body||'You have an inbox update',icon:'/icon-192.png',data:{url:'/'}}))});
self.addEventListener('notificationclick',event=>{event.notification.close();event.waitUntil(self.clients.openWindow('/'))});
