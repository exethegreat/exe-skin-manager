// Sayfa çizilmeden önce kayıtlı temayı uygular (açılışta renk titremesi olmasın).
try {
  if (localStorage.getItem("tema") === "light") document.documentElement.dataset.theme = "light";
} catch {}
