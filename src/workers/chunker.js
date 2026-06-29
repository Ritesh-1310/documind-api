const chunkText = (text, chunkSize = 512, overlap = 50) => {
  const words = text.split(/\s+/);
  const chunks = [];
  let i = 0;

  while (i < words.length) {
    const chunk = words.slice(i, i + chunkSize).join(' ');
    chunks.push(chunk);
    i += chunkSize - overlap;
  }

  return chunks.filter(c => c.trim().length > 0);
};

module.exports = { chunkText };