import { t, useI18n } from '../lib/i18n';
import { useAppearance } from '../lib/appearance';

const choices = [
  { value: 'light', label: '浅色', description: '明亮、清晰' },
  { value: 'dark', label: '深色', description: '熟悉的深色工作台' },
  { value: 'system', label: '跟随系统', description: '自动适配系统外观' },
] as const;

/** 原生单选框支持键盘方向键，选择后立即应用并保存主题。 */
export function AppearancePicker() {
  useI18n();
  const { theme, resolvedTheme, setTheme } = useAppearance();
  return <fieldset className="theme-fieldset">
    <legend>{t('外观主题')}</legend>
    <div className="theme-choices">
      {choices.map(choice => <label className={`theme-choice${theme === choice.value ? ' is-selected' : ''}`} key={choice.value}>
        <input type="radio" name="appearance-theme" value={choice.value} aria-label={t(choice.label)}
          checked={theme === choice.value} onChange={() => setTheme(choice.value)} />
        <span className={`theme-miniature miniature-${choice.value}`} aria-hidden="true">
          <span className="miniature-chrome"><i /><i /><i /></span>
          <span className="miniature-content"><span className="miniature-sidebar"><i /><i className="miniature-selection" /><i /></span>
            <span className="miniature-files"><i /><i /><i /></span>
            <span className="miniature-code"><i /><i /><i className="miniature-diff" /><i /></span></span>
        </span>
        <span className="theme-choice-title">{t(choice.label)}<span className="theme-check" aria-hidden="true">{theme === choice.value && <i className="codicon codicon-check" />}</span></span>
        <span className="theme-choice-description">{t(choice.description)}</span>
      </label>)}
    </div>
    <p className="theme-description">{theme === 'system'
      ? t('随系统外观自动切换，当前为{theme}。', { theme: t(resolvedTheme === 'light' ? '浅色' : '深色') })
      : t('切换立即生效，外观偏好会自动保存。')}</p>
  </fieldset>;
}
