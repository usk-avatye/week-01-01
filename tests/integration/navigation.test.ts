import assert from 'node:assert/strict';
import test from 'node:test';
import type { Role } from '../../src/contracts/auth.js';
import type { CampaignDto } from '../../src/contracts/campaigns.js';
import { createHttpFixture } from '../support/http.js';
import { goBack, mountNavigation, waitForNavigation } from '../support/navigation.js';

async function loginAs(fixture: Awaited<ReturnType<typeof createHttpFixture>>, role: Role) {
    await fixture.signup();
    if (role === 'ADMIN') await fixture.pool.query("UPDATE members SET role='ADMIN'");
    return fixture.login();
}

for (const [role, destination, heading] of [
    ['ADVERTISER', '#/campaigns', '내 캠페인'],
    ['ADMIN', '#/admin/campaigns', '전체 캠페인'],
] as const) {
    test(`authenticated ${role} auth-page visits replace history with the DB role destination`, async t => {
        const fixture = await createHttpFixture();
        const logged = await loginAs(fixture, role);
        const { dom, start } = mountNavigation(t, fixture, '#/login', logged.cookie);
        await start();
        const ready = () => dom.window.location.hash === destination &&
            dom.window.document.querySelector('h1')?.textContent === heading &&
            Boolean(dom.window.document.querySelector('.empty-state'));
        await waitForNavigation(ready, `${role} login page must resolve to its campaign list`);
        assert.equal(dom.window.history.length, 1);
        for (const route of ['#/signup', '#/admin/login']) {
            const entries: number = dom.window.history.length;
            dom.window.location.hash = route;
            await waitForNavigation(ready, `${role} ${route} must resolve to its campaign list`);
            assert.equal(dom.window.history.length, entries + 1, 'automatic redirects replace the entered route');
        }
    });

    test(`back to an old login entry keeps authenticated ${role} on its campaign list`, async t => {
        const fixture = await createHttpFixture();
        const logged = await loginAs(fixture, role);
        const { dom, start } = mountNavigation(t, fixture, '#/login', logged.cookie);
        dom.window.history.pushState(null, '', destination);
        await start();
        const ready = () => dom.window.location.hash === destination &&
            dom.window.document.querySelector('h1')?.textContent === heading &&
            Boolean(dom.window.document.querySelector('.empty-state'));
        await waitForNavigation(ready, 'Initial authenticated list must render');
        await goBack(dom);
        await waitForNavigation(ready, 'Back navigation must resolve the old login entry using the active session');
        assert.equal(dom.window.history.length, 2);
        assert.equal(dom.window.document.querySelector('[name="password"]'), null);
    });
}

test('anonymous members can navigate login and signup after the legacy login URL replaces its history entry', async t => {
    const fixture = await createHttpFixture();
    const { dom, start } = mountNavigation(t, fixture, '#/admin/login');
    await start();
    await waitForNavigation(() => dom.window.location.hash === '#/login' &&
        Boolean(dom.window.document.querySelector('[name="password"]')), 'Legacy login must show the common form');
    assert.equal(dom.window.history.length, 1);
    dom.window.document.querySelector<HTMLAnchorElement>('[href="#/signup"]')!.click();
    await waitForNavigation(() => Boolean(dom.window.document.querySelector('[name="displayName"]')), 'Anonymous signup must remain available');
    await goBack(dom);
    await waitForNavigation(() => dom.window.location.hash === '#/login' &&
        Boolean(dom.window.document.querySelector('[name="password"]')) &&
        !dom.window.document.querySelector('[name="displayName"]'), 'Back must return an anonymous member to login');
});

test('unauthenticated protected-route redirects replace history and show the common login form', async t => {
    const fixture = await createHttpFixture();
    const { dom, start } = mountNavigation(t, fixture, '#/admin/campaigns');
    await start();
    await waitForNavigation(() => dom.window.location.hash === '#/login' &&
        Boolean(dom.window.document.querySelector('[name="password"]')), 'Protected route must resolve to login');
    assert.equal(dom.window.history.length, 1);
});

test('logout and back navigation keep a revoked session on login instead of restoring a campaign screen', async t => {
    const fixture = await createHttpFixture();
    const logged = await loginAs(fixture, 'ADVERTISER');
    const created = await fixture.request<CampaignDto>('POST', '/api/campaigns', { name: 'History campaign', totalBudget: 1000 }, logged.cookie, logged.body.csrfToken);
    assert.equal(created.status, 201);
    const { dom, start } = mountNavigation(t, fixture, '#/campaigns', logged.cookie);
    await start();
    const campaignLink = `[href="#/campaigns/${created.body.id}"]`;
    await waitForNavigation(() => Boolean(dom.window.document.querySelector(campaignLink)), 'Campaign list must render');
    dom.window.document.querySelector<HTMLAnchorElement>(campaignLink)!.click();
    await waitForNavigation(() => dom.window.document.querySelector('h1')?.textContent === 'History campaign', 'Campaign detail must render');
    const logout = [...dom.window.document.querySelectorAll('button')].find(button => button.textContent === '로그아웃')!;
    logout.click();
    const loginReady = () => dom.window.location.hash === '#/login' && Boolean(dom.window.document.querySelector('[name="password"]'));
    await waitForNavigation(loginReady, 'Logout must render login');
    assert.equal(dom.window.history.length, 2, 'logout replaces the detail entry');
    await goBack(dom);
    await waitForNavigation(loginReady, 'Revoked session must stay on login after back');
    assert.equal((await fixture.pool.query('SELECT * FROM sessions')).rowCount, 0);
});
