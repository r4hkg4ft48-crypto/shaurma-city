'use strict';

require('./server');

setTimeout(()=>{
  const rebuild=require('../v2/backend/src/channel-launch-rebuild');
  rebuild.run()
    .then(r=>console.log('Channel clean launch wrapper · '+JSON.stringify(r)))
    .catch(e=>console.error('Channel clean launch wrapper',e.message));
},15000);
