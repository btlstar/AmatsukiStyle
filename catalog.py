"""Read cosmetic definitions from the installed client's Addressables catalog."""
import base64
import json
from pathlib import Path
import struct
import UnityPy

COSMETIC_TYPES = frozenset({6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 26, 27})


class Catalog:
    def __init__(self, game):
        game = Path(game).resolve()
        if not (game / 'mahjongP.exe').is_file():
            raise ValueError('请选择包含 mahjongP.exe 的天月游戏目录。')
        self.base = game / 'mahjongP_Data/StreamingAssets/aa'
        data = json.loads((self.base / 'catalog.json').read_text('utf8'))
        self.ids = data['m_InternalIds']
        self.keys = base64.b64decode(data['m_KeyDataString'], validate=True)
        buckets = base64.b64decode(data['m_BucketDataString'], validate=True)
        entries = base64.b64decode(data['m_EntryDataString'], validate=True)
        count = struct.unpack_from('<I', entries)[0]
        if len(entries) != 4 + 28 * count:
            raise ValueError('不支持的资源索引布局。')
        self.entries = [struct.unpack_from('<7i', entries, 4 + 28 * i) for i in range(count)]
        self.buckets = []
        pos = 4
        for _ in range(struct.unpack_from('<I', buckets)[0]):
            offset, size = struct.unpack_from('<II', buckets, pos)
            pos += 8
            indices = struct.unpack_from('<' + str(size) + 'I', buckets, pos)
            pos += 4 * size
            if any(i >= count for i in indices):
                raise ValueError('资源索引越界。')
            self.buckets.append((offset, indices))
        if pos != len(buckets):
            raise ValueError('资源分组布局不受支持。')
        self.cache = {}

    def _bundles(self, index, seen):
        if index in seen:
            return set()
        seen.add(index)
        internal, provider, dependency, *_ = self.entries[index]
        found = {self.ids[internal]} if provider == 0 else set()
        if dependency >= 0:
            for child in self.buckets[dependency][1]:
                found.update(self._bundles(child, seen))
        return found

    def read(self, asset):
        encoded = asset.encode('ascii')
        pos = self.keys.find(encoded)
        if pos < 5 or self.keys[pos - 5] != 0 or struct.unpack_from('<I', self.keys, pos - 4)[0] != len(encoded):
            raise ValueError('当前客户端缺少配置：' + asset)
        matches = [indices for offset, indices in self.buckets if offset == pos - 5]
        if len(matches) != 1:
            raise ValueError('资源映射不唯一：' + asset)
        bundles = set()
        for index in matches[0]:
            bundles.update(self._bundles(index, set()))
        for uri in sorted(bundles):
            name = uri.replace('\\', '/').rsplit('/', 1)[-1]
            if not name.endswith('.bundle') or name in {'.', '..'}:
                raise ValueError('未知配置资源路径。')
            path = self.base / 'StandaloneWindows64' / name
            if path not in self.cache:
                self.cache[path] = UnityPy.load(str(path))
            for key, obj in self.cache[path].container.items():
                if key.casefold() == asset.casefold():
                    return obj.read_typetree()
        raise ValueError('未在本地资源中找到配置：' + asset)

    def cosmetics(self):
        chars = self.read('Assets/Config/Character/CharacterConfig.asset')['itemList']
        skins = self.read('Assets/Config/Character/CharacterSkinConfig.asset')['itemList']
        items = self.read('Assets/Config/Inventory/ItemConfig.asset')['itemList']
        skins = [dict(skinId=v['skinId'], characterId=v['characterId']) for v in skins if v['skinId'] > 0 and v['characterId'] > 0 and (v['characterImgAddr'] or v['prefabAddr'])]
        listed_skins = {v['id'] for v in items if v['type'] == 7}
        skins = [v for v in skins if v['skinId'] in listed_skins]
        roles = {v['characterId'] for v in skins}
        return {
            'characters': [dict(characterId=v['characterId'], skinItemIdList=v['skinItemIdList'], emojiItemIdList=v['emojiItemIdList']) for v in chars if v['characterId'] in roles],
            'skins': skins,
            'items': [dict(itemId=v['id'], type=v['type']) for v in items if v['type'] in COSMETIC_TYPES],
        }
