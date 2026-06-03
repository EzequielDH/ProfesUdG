/* GSAP Animations Setup */

gsap.registerPlugin(ScrollTrigger);

// Custom SplitText function (workaround for paid plugin)
function splitTitle(el) {
  const html = el.innerHTML;
  el.innerHTML = '';
  const tmp = document.createElement('div');
  tmp.innerHTML = html;

  function processNode(node, parent) {
    if (node.nodeType === Node.TEXT_NODE) {
      const words = node.textContent.split(/(\s+)/);
      words.forEach(word => {
        if (/^\s+$/.test(word)) {
          parent.appendChild(document.createTextNode(word));
        } else if (word.length > 0) {
          const mask = document.createElement('span');
          mask.className = 'word-mask';
          [...word].forEach(ch => {
            const c = document.createElement('span');
            c.className = 'char';
            c.textContent = ch;
            mask.appendChild(c);
          });
          parent.appendChild(mask);
        }
      });
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const clone = node.cloneNode(false);
      [...node.childNodes].forEach(child => processNode(child, clone));
      parent.appendChild(clone);
    }
  }
  [...tmp.childNodes].forEach(child => processNode(child, el));
}

splitTitle(document.getElementById('heroTitle'));

// Entry animation timeline
const tl = gsap.timeline({ defaults: { ease: 'expo.out' } });

tl.to('#heroTitle .char', {
    y: 0,
    duration: 1.2,
    stagger: { each: 0.025, from: 'start' }
  })
  .to('#heroSub', { opacity: 1, y: 0, duration: 0.8 }, '-=0.6')
  .to('.stat', { opacity: 1, y: 0, duration: 0.5, stagger: 0.08 }, '-=0.5')
  .to('.search-section', { opacity: 1, y: 0, duration: 0.7 }, '-=0.3');

// Statistics counters animation
document.querySelectorAll('.stat-num').forEach(el => {
  const target = parseInt(el.dataset.target);
  const format = el.dataset.format;
  const obj = { val: 0 };
  gsap.to(obj, {
    val: target,
    duration: 1.8,
    delay: 0.4,
    ease: 'power2.out',
    onUpdate: () => {
      const v = Math.round(obj.val);
      if (format === 'k') {
        el.textContent = (v / 1000).toFixed(1) + 'k';
      } else {
        el.textContent = v.toLocaleString('es-MX');
      }
    }
  });
});

// ScrollTrigger reveals
document.querySelectorAll('.section .reveal').forEach(el => {
  gsap.fromTo(el,
    { opacity: 0, y: 30 },
    {
      opacity: 1, y: 0, duration: 0.7, ease: 'power2.out',
      scrollTrigger: { trigger: el, start: 'top 85%', toggleActions: 'play none none none' }
    }
  );
});

// Footer reveal
gsap.fromTo('.footer .reveal',
  { opacity: 0, y: 20 },
  {
    opacity: 1, y: 0, duration: 0.6, ease: 'power2.out',
    scrollTrigger: { trigger: '.footer', start: 'top 90%' }
  }
);
