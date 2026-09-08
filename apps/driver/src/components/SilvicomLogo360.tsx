import { SvgXml } from 'react-native-svg';
import { useTheme } from '@/theme/ThemeProvider';
import { SILVICOM_LOGO_360_DARK_XML, SILVICOM_LOGO_360_XML } from '@/theme/silvicomLogo360';

/**
 * The Silvicom 360 mark. `onHero` forces the light-on-dark variant whatever the appearance, because
 * the auth mast (D-DB15) draws it on the navy hero in the light theme too.
 */
export function SilvicomLogo360({
  width = 240,
  height = 46,
  onHero = false,
}: {
  width?: number;
  height?: number;
  onHero?: boolean;
}) {
  const { isDark } = useTheme();
  return (
    <SvgXml
      xml={isDark || onHero ? SILVICOM_LOGO_360_DARK_XML : SILVICOM_LOGO_360_XML}
      width={width}
      height={height}
      accessible
      accessibilityLabel="Silvicom 360"
    />
  );
}
