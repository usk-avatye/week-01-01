import type { Queryable } from './pool.js';

export async function normalizeDemoText(db: Queryable): Promise<void> {
    const separator = String.fromCodePoint(0x00B7);
    const legacyCampaigns = [
        ['advertiser-a@example.test', `신제품 런칭 ${separator} 예산 보호`, '신제품 런칭'],
        ['advertiser-b@example.test', `브랜드 인지도 ${separator} 독립 예산`, '브랜드 인지도'],
        ['browser-qa@example.test', `브라우저 검증 ${separator} <img src=x> 예산`, '집행 복구 검증'],
    ];
    for (const [email, oldName, newName] of legacyCampaigns) {
        await db.query(`UPDATE campaigns SET name=$3 WHERE name=$2
            AND owner_id=(SELECT id FROM members WHERE email=$1)`, [email, oldName, newName]);
    }
    await db.query(`UPDATE members SET display_name=COALESCE(NULLIF(
        btrim(regexp_replace(replace(display_name,$1,' '),'[[:space:]]+',' ','g')),''),'광고주')
        WHERE strpos(display_name,$1)>0`, [separator]);
    await db.query(`UPDATE campaigns SET name=COALESCE(NULLIF(
        btrim(regexp_replace(replace(name,$1,' '),'[[:space:]]+',' ','g')),''),'캠페인')
        WHERE strpos(name,$1)>0`, [separator]);
}
