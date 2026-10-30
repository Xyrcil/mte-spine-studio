(() => {
  const pending=window.__mteWallpaperPending={user:{},general:{}};
  window.wallpaperPropertyListener={
    applyUserProperties(value){Object.assign(pending.user,value);},
    applyGeneralProperties(value){Object.assign(pending.general,value);},
    setPaused(value){pending.paused=value;}
  };
})();
