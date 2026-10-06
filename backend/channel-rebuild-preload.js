'use strict';

setTimeout(()=>{
  try{
    const rebuild=require('../v2/backend/src/channel-launch-rebuild');
    rebuild.run()
      .then(r=>console.log('Channel clean launch preload · '+JSON.stringify(r)))
      .catch(e=>console.error('Channel clean launch preload',e.message));
  }catch(e){
    console.error('Channel clean launch preload require',e.message);
  }
},15000);
