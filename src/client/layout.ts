import { button, el, link, message } from './dom.js';
import type { PageContext } from './context.js';
export function layout(root: HTMLElement, title: string, context?: PageContext): HTMLElement {
    const header = el('header', '', 'site-header'), brand = link('Campaign Guard', context?.member.role === 'ADMIN' ? '#/admin/campaigns' : '#/campaigns', 'brand');
    const badge = el('span', '시뮬레이션', 'simulation');
    header.append(brand, badge);
    if (context) {
        const nav = el('nav', '', 'primary-nav');
        nav.setAttribute('aria-label', '주 메뉴');
        nav.append(link('캠페인', context.member.role === 'ADMIN' ? '#/admin/campaigns' : '#/campaigns'));
        header.append(nav);
        const account = el('div', '', 'account');
        account.append(el('span', `${context.member.displayName} (${context.member.role === 'ADMIN' ? '관리자, 조회 전용' : '광고주'})`));
        const feedback = el('span');
        const logout = button('로그아웃', async () => {
            logout.disabled = true;
            try {
                await context.api.request('POST', '/auth/logout', {});
                location.replace('#/login');
            }
            catch {
                message(feedback, '로그아웃을 확인하지 못했습니다. 다시 시도해 주세요.', true);
                logout.disabled = false;
            }
        }, 'button subtle');
        account.append(logout, feedback);
        header.append(account);
    }
    const main = el('main', '', 'container');
    if (title) {
        const heading = el('div', '', 'page-heading');
        heading.append(el('h1', title));
        main.append(heading);
    }
    root.replaceChildren(header, main);
    return main;
}
