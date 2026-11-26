const DEFAULT_FOLDER = "X Media";
const input = document.getElementById("folder");
const saveBtn = document.getElementById("save");
const status = document.getElementById("status");

chrome.storage.local.get({ folder: DEFAULT_FOLDER }).then(({ folder }) => {
  input.value = folder;
});

async function save() {
  await chrome.storage.local.set({ folder: input.value.trim() });
  status.textContent = "Saved";
  setTimeout(() => {
    status.textContent = "";
  }, 1500);
}

saveBtn.addEventListener("click", save);
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter") save();
});