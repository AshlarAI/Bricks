// The icon of each tool, by its real name (timeline/toolIcons.ts). The icons are compared with
// the components of @lucide/svelte by identity, so a wrong mapping fails here, not by eye.
import { describe, expect, it } from 'vitest';
import AppWindowIcon from '@lucide/svelte/icons/app-window';
import BinocularsIcon from '@lucide/svelte/icons/binoculars';
import BookOpenCheckIcon from '@lucide/svelte/icons/book-open-check';
import BotIcon from '@lucide/svelte/icons/bot';
import BrainIcon from '@lucide/svelte/icons/brain';
import CameraIcon from '@lucide/svelte/icons/camera';
import ChartLineIcon from '@lucide/svelte/icons/chart-line';
import ChevronRightIcon from '@lucide/svelte/icons/chevron-right';
import CodeIcon from '@lucide/svelte/icons/code';
import CpuIcon from '@lucide/svelte/icons/cpu';
import GlobeIcon from '@lucide/svelte/icons/globe';
import KeyboardIcon from '@lucide/svelte/icons/keyboard';
import ListChecksIcon from '@lucide/svelte/icons/list-checks';
import MailIcon from '@lucide/svelte/icons/mail';
import MessageSquareIcon from '@lucide/svelte/icons/message-square';
import PenIcon from '@lucide/svelte/icons/pen';
import PenLineIcon from '@lucide/svelte/icons/pen-line';
import PlayIcon from '@lucide/svelte/icons/play';
import PlugIcon from '@lucide/svelte/icons/plug';
import ScanEyeIcon from '@lucide/svelte/icons/scan-eye';
import SearchIcon from '@lucide/svelte/icons/search';
import SquareDashedMousePointerIcon from '@lucide/svelte/icons/square-dashed-mouse-pointer';
import WrenchIcon from '@lucide/svelte/icons/wrench';
import {
	MESSAGE_ICON,
	THINKING_ICON,
	toolIcon,
} from '../../src/lib/features/conversation/timeline/toolIcons';

describe('toolIcon: the icon says what the tool does', () => {
	it.each([
		['Bash', ChevronRightIcon],
		['Read', BookOpenCheckIcon],
		['Grep', SearchIcon],
		['CodeSearch', SearchIcon],
		['CodeScout', CodeIcon],
		['CodeStats', ChartLineIcon],
		['Job', CpuIcon],
		['Write', PenIcon],
		['Edit', PenLineIcon],
		['WebSearch', BinocularsIcon],
		['Agent', BotIcon],
		['Managent', BotIcon],
		['Messagent', MailIcon],
	])('%s has its own icon', (name, icon) => {
		expect(toolIcon(name)).toBe(icon);
	});

	it('the removed Agents, AgentControl, AgentProfiles and SendMessage tools have no icon of their own', () => {
		expect(toolIcon('Agents')).toBe(WrenchIcon);
		expect(toolIcon('AgentControl')).toBe(WrenchIcon);
		expect(toolIcon('AgentProfiles')).toBe(WrenchIcon);
		expect(toolIcon('SendMessage')).toBe(WrenchIcon);
	});

	it('the shell tools share the chevron, whatever their spelling', () => {
		expect(toolIcon('bash')).toBe(ChevronRightIcon);
		expect(toolIcon('PowerShell')).toBe(ChevronRightIcon);
	});

	it('a computer-use tool shows the pointer for pointer actions and fallback, and action-specific icons otherwise', () => {
		expect(toolIcon('mcp__computer-use__screenshot')).toBe(SquareDashedMousePointerIcon);
		expect(toolIcon('mcp__computer-use__left_click')).toBe(SquareDashedMousePointerIcon);
		expect(toolIcon('mcp__computer-use__click')).toBe(SquareDashedMousePointerIcon);
		expect(toolIcon('mcp__computer-use__drag')).toBe(SquareDashedMousePointerIcon);
		expect(toolIcon('mcp__computer-use__scroll')).toBe(SquareDashedMousePointerIcon);

		expect(toolIcon('mcp__computer-use__type_text')).toBe(KeyboardIcon);
		expect(toolIcon('mcp__computer-use__press_key')).toBe(KeyboardIcon);
		expect(toolIcon('mcp__computer-use__hotkey')).toBe(KeyboardIcon);
		expect(toolIcon('mcp__computer-use__set_value')).toBe(KeyboardIcon);

		expect(toolIcon('mcp__computer-use__get_desktop_state')).toBe(CameraIcon);
		expect(toolIcon('mcp__computer-use__get_window_state')).toBe(CameraIcon);
		expect(toolIcon('mcp__computer-use__zoom')).toBe(CameraIcon);
		expect(toolIcon('mcp__computer-use__get_accessibility_tree')).toBe(ScanEyeIcon);
		expect(toolIcon('mcp__computer-use__parse_visual_regions')).toBe(ScanEyeIcon);

		expect(toolIcon('mcp__computer-use__browser_navigate')).toBe(GlobeIcon);
		expect(toolIcon('mcp__computer-use__browser_click')).toBe(GlobeIcon);
		expect(toolIcon('mcp__computer-use__page')).toBe(GlobeIcon);

		expect(toolIcon('mcp__computer-use__run_steps')).toBe(ListChecksIcon);
		expect(toolIcon('mcp__computer-use__run_script')).toBe(PlayIcon);

		expect(toolIcon('mcp__computer-use__launch_app')).toBe(AppWindowIcon);
		expect(toolIcon('mcp__computer-use__bring_to_front')).toBe(AppWindowIcon);
		expect(toolIcon('mcp__computer-use__list_windows')).toBe(AppWindowIcon);
		expect(toolIcon('mcp__computer-use__list_apps')).toBe(AppWindowIcon);
		expect(toolIcon('mcp__computer-use__set_window_frame')).toBe(AppWindowIcon);
		expect(toolIcon('mcp__computer-use__invoke_menu')).toBe(AppWindowIcon);
	});

	it('any other MCP tool shows the plug', () => {
		expect(toolIcon('mcp__autre__x')).toBe(PlugIcon);
		expect(toolIcon('mcp__github__create_issue')).toBe(PlugIcon);
	});

	it('an unknown tool shows the wrench', () => {
		expect(toolIcon('InconnuDuTout')).toBe(WrenchIcon);
		expect(toolIcon('')).toBe(WrenchIcon);
	});

	it('the step icons of a run are the brain for reasoning and the message square for a message', () => {
		expect(THINKING_ICON).toBe(BrainIcon);
		expect(MESSAGE_ICON).toBe(MessageSquareIcon);
	});
});
