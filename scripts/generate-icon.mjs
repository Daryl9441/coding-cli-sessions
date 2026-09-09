import sharp from "sharp";
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
<defs><linearGradient id="bg" x2="1" y2="1"><stop stop-color="#102332"/><stop offset="1" stop-color="#071119"/></linearGradient><linearGradient id="blue"><stop stop-color="#69e4ff"/><stop offset="1" stop-color="#3293fb"/></linearGradient></defs>
<rect x="24" y="24" width="464" height="464" rx="110" fill="url(#bg)"/>
<rect x="76" y="103" width="360" height="306" rx="35" fill="#142e3f" stroke="#2c4d61" stroke-width="5"/>
<path d="M78 165h356" stroke="#2c4d61" stroke-width="5"/><circle cx="112" cy="136" r="9" fill="#ffb06f"/><circle cx="142" cy="136" r="9" fill="#85d4b4"/>
<path d="m120 219 43 34-43 34" stroke="#edf8ff" stroke-width="17" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
<path d="M190 285h65" stroke="#edf8ff" stroke-width="17" stroke-linecap="round"/>
<rect x="117" y="334" width="123" height="20" rx="10" fill="url(#blue)"/><rect x="264" y="334" width="123" height="20" rx="10" fill="#efaa77"/>
<circle cx="386" cy="216" r="14" fill="#72dfb3"/>
</svg>`;
await sharp(Buffer.from(svg)).png().toFile("assets/icon.png");
