import { button, el } from './dom.js';
export function pager(page: number, hasNext: boolean, load: (page: number) => Promise<void>): HTMLElement {
    const nav = el('nav', '', 'pager');
    nav.hidden = page === 1 && !hasNext;
    nav.setAttribute('aria-label', '페이지 이동');
    const previous = button('이전', () => load(page - 1), 'button subtle'), next = button('다음', () => load(page + 1), 'button subtle');
    previous.disabled = page <= 1;
    next.disabled = !hasNext;
    nav.append(previous, el('span', `${page} 페이지`), next);
    return nav;
}
