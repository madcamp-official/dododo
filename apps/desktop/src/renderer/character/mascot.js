const character = document.querySelector(".character");
const alphaCanvas = document.createElement("canvas");
const alphaContext = alphaCanvas.getContext("2d", { willReadFrequently: true });
let isIgnoringMouse = true;

function prepareAlphaMask() {
  if (!(character instanceof HTMLImageElement) || alphaContext === null) return;
  alphaCanvas.width = character.naturalWidth;
  alphaCanvas.height = character.naturalHeight;
  alphaContext.clearRect(0, 0, alphaCanvas.width, alphaCanvas.height);
  alphaContext.drawImage(character, 0, 0);
}

function isOpaquePixel(clientX, clientY) {
  if (!(character instanceof HTMLImageElement) || alphaContext === null || !character.complete) return false;
  const bounds = character.getBoundingClientRect();
  if (bounds.width === 0 || bounds.height === 0) return false;

  const sourceX = Math.min(
    character.naturalWidth - 1,
    Math.max(0, Math.floor((clientX - bounds.left) / bounds.width * character.naturalWidth)),
  );
  const sourceY = Math.min(
    character.naturalHeight - 1,
    Math.max(0, Math.floor((clientY - bounds.top) / bounds.height * character.naturalHeight)),
  );
  try {
    return alphaContext.getImageData(sourceX, sourceY, 1, 1).data[3] > 16;
  } catch {
    // file:// 이미지가 플랫폼 정책상 canvas를 오염시키는 경우에도 마스코트가 영원히
    // click-through 상태로 잠기지 않게 idle 캐릭터의 보수적인 경계로 폴백한다.
    const normalizedX = (clientX - bounds.left) / bounds.width;
    const normalizedY = (clientY - bounds.top) / bounds.height;
    return normalizedX >= 0.24 && normalizedX <= 0.76 && normalizedY >= 0.05 && normalizedY <= 0.9;
  }
}

function updateMousePassthrough(event) {
  const shouldIgnore = !isOpaquePixel(event.clientX, event.clientY);
  if (shouldIgnore === isIgnoringMouse) return;
  isIgnoringMouse = shouldIgnore;
  window.desktopMascot?.setMousePassthrough(shouldIgnore);
}

if (character instanceof HTMLImageElement) {
  if (character.complete) prepareAlphaMask();
  else character.addEventListener("load", prepareAlphaMask, { once: true });
  window.addEventListener("mousemove", updateMousePassthrough);
}
