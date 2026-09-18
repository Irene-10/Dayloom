if('serviceWorker' in navigator && location.protocol!=='file:') navigator.serviceWorker.register('/sw.js').catch(()=>{});
