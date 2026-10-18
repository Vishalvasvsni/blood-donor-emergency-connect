// Loads the Phone.Email button code from /phoneemail-button.html (if the site
// owner pasted any there) into the given element. Resolves to true if a button
// was added, false if the file holds only comments / is missing.
window.loadPhoneEmailButton = async function (slot) {
  try {
    const res = await fetch('/phoneemail-button.html', { cache: 'no-cache' });
    if (!res.ok) return false;
    const html = (await res.text()).replace(/<!--[\s\S]*?-->/g, '').trim();
    if (!html) return false;
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    // Scripts inserted via innerHTML never run, so rebuild them as live elements.
    tpl.content.querySelectorAll('script').forEach((old) => {
      const live = document.createElement('script');
      for (const a of old.attributes) live.setAttribute(a.name, a.value);
      live.textContent = old.textContent;
      old.replaceWith(live);
    });
    slot.appendChild(tpl.content);
    return true;
  } catch (e) {
    return false;
  }
};
