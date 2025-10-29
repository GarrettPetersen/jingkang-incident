#!/usr/bin/env node
// Apply region/prefecture alias mappings to cities.json and add missing hubs if needed.

import fs from 'node:fs';
import path from 'node:path';

const CITIES = path.resolve(process.cwd(), 'data/cities.json');

// Hubs to ensure exist
const ensureCities = [
    { id: 'chengdu', zh: '成都', pinyin: 'Chengdu' },
    { id: 'xingyuan', zh: '興元', pinyin: 'Xingyuan', aliases: ['漢中'] },
    { id: 'lizhou', zh: '利州', pinyin: 'Lizhou', aliases: ['廣元'] },
    { id: 'shangjing', zh: '上京', pinyin: 'Shangjing' },
    { id: 'yueyang', zh: '岳陽', pinyin: 'Yueyang', aliases: ['岳州'] },
    { id: 'yongzhou-gn', zh: '邕州', pinyin: 'Yongzhou', aliases: ['南寧'] },
    { id: 'yingchang', zh: '穎昌', pinyin: 'Yingchang' },
    { id: 'ezhou', zh: '鄂州', pinyin: 'Ezhou', aliases: ['武昌'] },
    { id: 'yanan', zh: '延安', pinyin: 'Yanan', aliases: ['延州'] },
    { id: 'qinzhou', zh: '秦州', pinyin: 'Qinzhou' },
    { id: 'fengzhou', zh: '鳳州', pinyin: 'Fengzhou' },
    { id: 'longzhou', zh: '隴州', pinyin: 'Longzhou' },
    { id: 'wuguocheng', zh: '五國城', pinyin: 'Wuguocheng' },
];

// Alias mappings: alias label -> array of city ids
const aliasMap = new Map([
    ['平州', ['yanjing']],
    ['燕山等八路', ['yanjing']],
    ['汴河沿線', ['kaifeng']],
    ['河北東西路、山東東西路', ['yanjing', 'cangzhou']],
    ['中都路', ['yanjing']],
    ['河北路', ['yanjing']],
    ['山東路', ['cangzhou', 'haizhou']],
    ['諸路驛舍', ['kaifeng']],
    ['黃汴河段與諸渠', ['kaifeng']],
    ['中都與諸路倉場', ['yanjing', 'kaifeng']],
    ['山東鹽使司', ['haizhou']],
    ['寶坻', ['yanjing']],
    ['諸路轉運司', ['kaifeng']],
    ['中都、上京等路', ['yanjing', 'shangjing']],
    ['兩浙', ['hangzhou']],
    ['江東西', ['hangzhou', 'yangzhou']],
    ['江南東路', ['hangzhou']],
    ['興化軍', ['taizhou']],
    ['淮南路', ['yangzhou']],
    ['漣水軍', ['huaiyin']],
    ['淮甸', ['yangzhou', 'huaiyin']],
    ['解州鹽池', ['taiyuan']],
    ['沿河、沿淮、沿江諸路', ['yangzhou', 'huaiyin', 'zhenjiang', 'nanjing']],
    ['沿河諸路', ['yangzhou', 'huaiyin']],
    ['陝西、四川邊路', ['xingyuan', 'lizhou']],
    ['浚州、滑州', ['kaifeng', 'huaiyang']],
    ['行在', ['hangzhou']],
    ['應天府', ['huaiyang']],
    ['太行山', ['taiyuan']],
    ['邢州', ['daming']],
    ['洺州', ['daming']],
    ['相州', ['daming']],
    ['西京至太原諸路', ['taiyuan']],
    ['杞、拱州一帶', ['kaifeng']],
    ['中京等兩路', ['kaifeng']],
    ['燕京及所屬', ['yanjing']],
    ['太原—文水—榆次', ['taiyuan']],
    ['河北、青齊一路', ['cangzhou', 'daming']],
    ['河南→河北', ['kaifeng', 'yanjing']],
    ['京畿與河北等路', ['yanjing']],
    ['江、浙沿流州軍', ['hangzhou', 'yangzhou']],
    ['京西—淮南—河南—河北', ['kaifeng', 'yangzhou', 'yanjing']],
    ['上京', ['shangjing']],
    ['兩浙與福建', ['hangzhou', 'fuzhou']],
    ['上京路', ['shangjing']],
    ['河北、河東', ['yanjing', 'taiyuan']],
    // Minor localities -> hubs
    ['顯寧寺', ['kaifeng']],
    ['藕塘', ['yangzhou']],
    ['六合', ['nanjing']],
    ['靜安鎮', ['nanjing']],
    ['沐陽', ['huaiyin']],
    ['泗州', ['huaiyin']],
    ['太平州', ['nanjing']],
    ['密州', ['cangzhou']],
    ['會稽', ['hangzhou']],
    ['揚子江', ['yangzhou', 'zhenjiang', 'jiujiang']],
    ['黃天蕩、金山', ['zhenjiang']],
    ['定海縣', ['ningbo']],
    ['昌國縣', ['ningbo']],
    ['富平', ['xingyuan']],
    ['邕州', ['yongzhou-gn']],
    ['昌國縣與寧波海道', ['ningbo']],
    ['臨安、臨平', ['hangzhou']],
    ['江渡(鎮江一帶)', ['zhenjiang']],
    ['汝州', ['huaiyang', 'kaifeng']],
    ['渭州、延安', ['yanan']],
    ['北京(大名府一帶)', ['daming']],
    ['長水（西京）', ['taiyuan']],
    ['馬家渡', ['nanjing']],
    ['和尚原', ['xingyuan']],
    ['玉隆觀', ['nanchang']],
    ['江陰軍', ['zhenjiang']],
    ['沅、湘', ['tanzhou', 'yueyang']],
    ['石港、料角、崇明鎮', ['ningbo']],
    ['饒州', ['nanchang']],
    ['鄂渚', ['ezhou']],
    ['西京、北京、遼東等路', ['taiyuan', 'yanjing']],
    ['夔路', ['tanzhou', 'yueyang']],
    ['金國元帥府', ['yanjing']],
    ['荊南', ['tanzhou']],
    ['仙人關', ['yanan']],
    ['諸州', ['kaifeng']],
    ['秦州', ['qinzhou']],
    ['鳳州', ['fengzhou']],
    ['隴州', ['longzhou']],
    ['沿江諸郡', ['yangzhou', 'zhenjiang', 'jiujiang']],
    ['荊南府一帶', ['tanzhou']],
    ['五國城', ['wuguocheng']],
    ['湖湘', ['tanzhou']],
    ['壽春、藕塘一帶', ['yangzhou']],
    ['採石、宣化渡', ['nanjing', 'xuanzhou']],
    ['東京(開封)等', ['kaifeng']],
    ['祁州', ['daming']],
    ['朱仙鎮', ['kaifeng']],
    ['雲中', ['taiyuan']],
    ['柳子鎮', ['suzhou-anhui']],
    ['朱仙鎮至南撤', ['kaifeng']],
    ['劉冷莊', ['yingchang']],
    ['郾城', ['yingchang']],
    ['穎昌', ['yingchang']],
    ['諸路州縣與猛安謀克部', ['yanjing', 'kaifeng']],
    ['解州、安邑池', ['taiyuan']],
    ['安肅 雄州 霸州 廣信', ['yanjing']],
    ['陝西五路', ['xingyuan', 'yanan']],
    ['燕山府', ['yanjing']],
    ['湖南', ['tanzhou', 'yueyang']],
    ['汴城近郊', ['kaifeng']],
    ['行在都茶場', ['hangzhou']],
    ['鐵路步', ['nanjing']],
    ['虔州、饒州等監', ['nanchang']],
    ['順昌', ['yangzhou', 'huaiyang']],
    ['潁河', ['yingchang']],
    ['郾城、穎昌西', ['yingchang']],
    ['郾城—鄭州一線', ['yingchang']],
    ['燕山', ['yanjing']],
    ['長沙', ['tanzhou']],
    ['和州—柘皋', ['hefei']],
    ['石樑河', ['ningbo']],
    ['河池', ['lizhou']],
    ['利州東西路', ['lizhou']],
    ['興州', ['xingyuan']],
    ['四川', ['chengdu']],
    ['臨安與鄂州', ['hangzhou', 'ezhou']],
    ['龍德別宮', ['hangzhou']],
    ['燕京/汴京往來', ['yanjing', 'kaifeng']],
    ['兩界邊境', ['xingyuan', 'kaifeng']],
    ['京西', ['kaifeng']],
    ['陝西', ['yanan', 'xingyuan']],
    ['大散關', ['yanan']],
    ['壽、鄧、鳳翔等州', ['yanan', 'yangzhou', 'huaiyang']],
]);

function main() {
    const cities = JSON.parse(fs.readFileSync(CITIES, 'utf8'));
    const byId = new Map(cities.map(c => [c.id, c]));

    // Ensure hubs
    for (const h of ensureCities) {
        if (!byId.has(h.id)) {
            const obj = {
                id: h.id,
                zh: h.zh,
                pinyin: h.pinyin,
                aliases: Array.isArray(h.aliases) ? h.aliases.slice() : [],
                name_zh: h.zh,
                name_pinyin: h.pinyin,
                type: 'city',
            };
            cities.push(obj);
            byId.set(h.id, obj);
            console.log(`Added hub: ${h.id} (${h.zh})`);
        }
    }

    // Apply alias mappings
    let aliasAdded = 0;
    for (const [alias, ids] of aliasMap.entries()) {
        for (const id of ids) {
            const c = byId.get(id);
            if (!c) { console.warn(`Target id not found for alias '${alias}': ${id}`); continue; }
            if (!Array.isArray(c.aliases)) c.aliases = [];
            if (!c.aliases.includes(alias)) { c.aliases.push(alias); aliasAdded++; }
        }
    }

    fs.writeFileSync(CITIES, JSON.stringify(cities, null, 2), 'utf8');
    console.log(`Applied alias mappings: ${aliasAdded} alias entries added.`);
}

main();


