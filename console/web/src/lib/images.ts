// A screenshot that is not there yet (a CI run sends them only while someone watches) is hidden,
// not shown broken; the next version of it shows again.

export function hideBroken(event: Event): void {
  if (event.target instanceof HTMLImageElement) {
    event.target.classList.add("invisible");
  }
}

export function showLoaded(event: Event): void {
  if (event.target instanceof HTMLImageElement) {
    event.target.classList.remove("invisible");
  }
}
