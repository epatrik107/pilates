// Theme initializer – loaded synchronously in <head> to prevent FOUC
(function() {
  var t = localStorage.getItem('theme');
  if (t) document.documentElement.setAttribute('data-theme', t);
  else if (window.matchMedia('(prefers-color-scheme: dark)').matches) document.documentElement.setAttribute('data-theme', 'dark');
})();
