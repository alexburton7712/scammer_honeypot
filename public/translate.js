function typeWriter(el, text, speed = 55) {
  el.innerHTML = "";
  const chars = Array.from(text);
  const cursor = document.createElement("span");
  cursor.className = "cursor";
  el.appendChild(cursor);
  let i = 0;
  const interval = setInterval(() => {
    if (i < chars.length) {
      el.insertBefore(document.createTextNode(chars[i]), cursor);
      i++;
    } else {
      clearInterval(interval);
      setTimeout(() => cursor.remove(), 1500);
    }
  }, speed);
}

async function translateMessage(langCode) {
  try {
    const res = await fetch(
      `https://api.mymemory.translated.net/get?q=Fuck+you+scammer&langpair=en|${langCode}`
    );
    const data = await res.json();
    const translated = data.responseData?.translatedText;
    if (translated && translated.toLowerCase() !== "fuck you scammer") {
      return translated;
    }
    return null;
  } catch (err) {
    return null;
  }
}

async function handleTranslation() {
  const fullLang = navigator.language || navigator.userLanguage || "en";
  const langCode = fullLang.split("-")[0].toLowerCase();
  if (langCode === "en") return;

  const el = document.getElementById("translated");
  el.innerHTML = '<span class="cursor"></span>';

  const translation = await translateMessage(langCode);
  if (translation) {
    typeWriter(el, translation);
  } else {
    el.innerHTML = "";
  }
}

handleTranslation();
