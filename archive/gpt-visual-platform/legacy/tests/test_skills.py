"""技能管理功能测试"""
import pytest
from modules.skills import get_all_skills, get_skills_by_category, get_skill_by_id, get_skills_by_platform, validate_skills


def test_get_all_skills():
    """测试获取所有技能"""
    skills = get_all_skills()
    assert isinstance(skills, list)
    assert len(skills) > 0
    for skill in skills:
        assert isinstance(skill, dict)
        assert 'id' in skill
        assert 'name' in skill
        assert 'description' in skill
        assert 'platforms' in skill
        assert 'category' in skill


def test_get_skills_by_category():
    """测试按类别获取技能"""
    unity_skills = get_skills_by_category('unity')
    assert isinstance(unity_skills, list)
    assert len(unity_skills) > 0
    for skill in unity_skills:
        assert skill['category'] == 'unity'

    web_skills = get_skills_by_category('web')
    assert isinstance(web_skills, list)
    assert len(web_skills) > 0
    for skill in web_skills:
        assert skill['category'] == 'web'


def test_get_skill_by_id():
    """测试通过ID获取技能"""
    playmode_skill = get_skill_by_id('PlayMode')
    assert isinstance(playmode_skill, dict)
    assert playmode_skill['id'] == 'PlayMode'
    assert playmode_skill['name'] == 'Unity PlayMode'

    # 测试不存在的技能
    non_existent_skill = get_skill_by_id('NonExistentSkill')
    assert non_existent_skill is None


def test_get_skills_by_platform():
    """测试按平台获取技能"""
    mac_skills = get_skills_by_platform('mac')
    assert isinstance(mac_skills, list)
    assert len(mac_skills) > 0
    for skill in mac_skills:
        assert 'mac' in skill['platforms']

    android_skills = get_skills_by_platform('android')
    assert isinstance(android_skills, list)
    assert len(android_skills) > 0
    for skill in android_skills:
        assert 'android' in skill['platforms']


def test_validate_skills():
    """测试验证技能列表"""
    valid_skills = validate_skills(['PlayMode', 'EditMode'])
    assert isinstance(valid_skills, list)
    assert len(valid_skills) == 2
    assert valid_skills[0]['id'] == 'PlayMode'
    assert valid_skills[1]['id'] == 'EditMode'

    # 测试包含无效技能的列表
    mixed_skills = validate_skills(['PlayMode', 'NonExistentSkill'])
    assert isinstance(mixed_skills, list)
    assert len(mixed_skills) == 1
    assert mixed_skills[0]['id'] == 'PlayMode'
