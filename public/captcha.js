const ROUNDS = [
  { title: "Select all images with crosswalks",    prompt: "Click verify once there are none left.", targets: ["images/crosswalk_images/crosswalk1.png","images/crosswalk_images/crosswalk2.png","images/crosswalk_images/crosswalk3.png"] },
  { title: "Select all images with traffic lights", prompt: "Click verify once there are none left.", targets: ["images/streetlight_images/streetlight1.png","images/streetlight_images/streetlight2.png","images/streetlight_images/streetlight3.png"] },
  { title: "Select all images with buses",          prompt: "Click verify once there are none left.", targets: ["images/bus_images/bus1.png","images/bus_images/bus2.png","images/bus_images/bus3.png"] },
];

const ALL_RANDOMS = Array.from({length: 18}, (_, i) => `images/random_images/random${i+1}.png`);

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

let randomPool = shuffle(ALL_RANDOMS);
function pickRandoms(n) {
  if (randomPool.length < n) randomPool = shuffle(ALL_RANDOMS);
  return randomPool.splice(0, n);
}

let currentRound = 0;
let selected = new Set();
let targetIndices = new Set();

function buildGrid(round) {
  const grid = document.getElementById("imageGrid");
  grid.innerHTML = "";
  selected.clear();
  targetIndices.clear();

  const cfg = ROUNDS[round];
  document.getElementById("challengeTitle").textContent = cfg.title;
  document.getElementById("challengePrompt").textContent = cfg.prompt;

  const distractors = pickRandoms(6);
  const cells = [
    ...cfg.targets.map(src => ({ src, isTarget: true })),
    ...distractors.map(src => ({ src, isTarget: false })),
  ];
  const shuffled = shuffle(cells);

  shuffled.forEach((cell, i) => {
    if (cell.isTarget) targetIndices.add(i);

    const div = document.createElement("div");
    div.className = "grid-cell";

    const img = document.createElement("img");
    img.src = cell.src;
    img.style.cssText = "width:100%;height:100%;object-fit:cover;display:block;";
    div.appendChild(img);

    div.addEventListener("click", () => {
      div.classList.toggle("selected");
      if (div.classList.contains("selected")) selected.add(i);
      else selected.delete(i);
    });

    grid.appendChild(div);
  });
}

function showSpinner(msg) {
  document.getElementById("challenge").classList.remove("active");
  document.getElementById("spinner").style.display = "block";
  document.getElementById("status").textContent = msg;
}

function showFinal() {
  document.getElementById("spinner").style.display = "none";
  document.getElementById("status").className = "status connected";
  document.getElementById("status").textContent = "✓ Verification complete. Session active.";
}

document.getElementById("verifyBtn").addEventListener("click", () => {
  currentRound++;
  if (currentRound < ROUNDS.length) {
    showSpinner("Verifying images…");
    setTimeout(() => {
      document.getElementById("spinner").style.display = "none";
      document.getElementById("challenge").classList.add("active");
      buildGrid(currentRound);
    }, 1800);
  } else {
    showSpinner("Finalizing verification…");
    setTimeout(showFinal, 2500);
  }
});

prewarmWorkers();
connectWS();

document.getElementById("captchaBox").addEventListener("click", () => {
  if (document.getElementById("checkbox").classList.contains("checked")) return;

  startHammer();
  document.getElementById("checkbox").classList.add("checked");
  document.getElementById("captchaBox").style.cursor = "default";
  document.getElementById("status").textContent = "";

  setTimeout(() => {
    document.getElementById("challenge").classList.add("active");
    buildGrid(0);
  }, 1200);
});
