import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import _get from 'lodash.get';
import _set from 'lodash.set';
import {
  ANSWER_CANCEL,
  flags,
  InstallContext,
  PluginHook,
  printAskProfile,
  promptListForProjectId,
  promptOverwrite,
  Task,
} from '@jovotech/cli-core';
import type { GetContext, GetEvents, ParseContextGet } from '@jovotech/cli-command-get';
import type { BuildEvents } from '@jovotech/cli-command-build';
import { FileBuilder, FileObject } from '@jovotech/filebuilder';

import * as smapi from '../smapi';
import { AskSkillList, checkForAskCli, PluginContextAlexa, prepareSkillList } from '../utils';
import defaultFiles from '../utils/DefaultFiles.json';
import { AlexaCli } from '..';

export interface GetContextAlexa extends PluginContextAlexa, GetContext {
  args: GetContext['args'];
  flags: GetContext['flags'] & { 'ask-profile'?: string; 'skill-id'?: string };
}

export class GetHook extends PluginHook<GetEvents | BuildEvents> {
  $plugin!: AlexaCli;
  $context!: GetContextAlexa;

  install(): void {
    this.middlewareCollection = {
      'install': [this.addCliOptions.bind(this)],
      'parse': [this.checkForPlatform.bind(this)],
      'before.get': [
        checkForAskCli,
        this.updatePluginContext.bind(this),
        this.checkForExistingPlatformFiles.bind(this),
      ],
      'get': [this.get.bind(this)],
    };
  }

  /**
   * Add platform-specific CLI options, including flags and args.
   * @param context - Context providing an access point to command flags and args.
   */
  addCliOptions(context: InstallContext): void {
    if (context.command !== 'get') {
      return;
    }

    context.flags['ask-profile'] = flags.string({
      default: 'default',
      description: 'Name of used ASK profile',
    });
    context.flags['skill-id'] = flags.string({ char: 's', description: 'Alexa Skill ID' });
  }

  /**
   * Checks if the currently selected platform matches this CLI plugin.
   * @param context - Context containing information after flags and args have been parsed by the CLI.
   */
  checkForPlatform(context: ParseContextGet): void {
    // Check if this plugin should be used or not.
    if (context.args.platform && context.args.platform !== this.$plugin.$id) {
      this.uninstall();
    }
  }

  /**
   * Updates the current plugin context with platform-specific values.
   */
  updatePluginContext(): void {
    this.$context.askProfile =
      this.$context.flags['ask-profile'] || this.$plugin.$config.askProfile;

    this.$context.skillId =
      this.$context.flags['skill-id'] ||
      _get(this.$plugin.$config, '[".ask/"]["ask-states.json"].profiles.default.skillId') ||
      _get(this.$plugin.$config, 'options.skillId');
  }

  /**
   * Checks if platform-specific files already exist and prompts for overwriting them.
   */
  async checkForExistingPlatformFiles(): Promise<void> {
    if (!this.$context.flags.overwrite && existsSync(this.$plugin.getPlatformPath())) {
      const answer = await promptOverwrite('Found existing project files. How to proceed?');
      if (answer.overwrite === ANSWER_CANCEL) {
        this.uninstall();
      }
    }
  }

  /**
   * Fetches platform-specific models from the Alexa Skills Console.
   */
  async get(): Promise<void> {
    const getTask: Task = new Task(
      `Getting Alexa Skill projects ${printAskProfile(this.$context.askProfile)}`,
    );

    // If no skill id and thus no specified project can be found, try to prompt for one.
    if (!this.$context.skillId) {
      let skills: AskSkillList = { skills: [] };
      const getSkillListTask: Task = new Task('Getting a list of all your skills', async () => {
        skills = await smapi.listSkills(this.$context.askProfile);
      });

      await getSkillListTask.run();
      const list = prepareSkillList(skills);

      try {
        const answer = await promptListForProjectId(list);

        this.$context.skillId = answer.projectId;
      } catch (error) {
        return;
      }
    }

    const getSkillInformationTask: Task = new Task('Getting skill information', async () => {
      const skillPackagePath: string = this.$plugin.getSkillPackagePath();
      if (!existsSync(skillPackagePath)) {
        mkdirSync(skillPackagePath, { recursive: true });
      }

      const skillInformation = await smapi.getSkillInformation(
        this.$context.skillId!,
        'development',
        this.$context.askProfile,
      );
      writeFileSync(this.$plugin.getSkillJsonPath(), JSON.stringify(skillInformation, null, 2));
      this.setAlexaSkillId(this.$context.skillId!);

      // Try to get account linking information.
      try {
        const accountLinkingJson = await smapi.getAccountLinkingInformation(
          this.$context.skillId!,
          'development',
          this.$context.askProfile,
        );

        if (accountLinkingJson) {
          writeFileSync(
            this.$plugin.getAccountLinkingPath(),
            JSON.stringify({ accountLinkingRequest: accountLinkingJson }, null, 2),
          );
          return `Account Linking Information saved to ${this.$plugin.getAccountLinkingPath()}`;
        }
      } catch (error) {
        // If account linking information is not available, do nothing.
        if (!error.message.includes('AccountLinking is not present for given skillId')) {
          throw error;
        }
      }
    });

    const getModelsTask: Task = new Task('Getting Alexa Skill model files', async () => {
      const alexaModelPath: string = this.$plugin.getModelsPath();
      if (!existsSync(alexaModelPath)) {
        mkdirSync(alexaModelPath, { recursive: true });
      }

      const modelLocales: string[] = [];

      if (this.$context.flags.locale) {
        modelLocales.push(...this.$context.flags.locale);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const skillJson = require(this.$plugin.getSkillJsonPath());
        const skillJsonLocales = _get(skillJson, 'manifest.publishingInformation.locales');
        modelLocales.push(...Object.keys(skillJsonLocales));
      }
      for (const locale of modelLocales) {
        const model = await smapi.getInteractionModel(
          this.$context.skillId!,
          locale,
          'development',
          this.$context.askProfile,
        );
        writeFileSync(this.$plugin.getModelPath(locale), JSON.stringify(model, null, 2));
      }
      return modelLocales.join(', ');
    });

    getTask.add(getSkillInformationTask, getModelsTask);

    await getTask.run();
  }

  /**
   * Saves skillId to .ask/config.
   * @param skillId - Skill ID.
   */
  setAlexaSkillId(skillId: string): void {
    const askConfigFolderPath: string = this.$plugin.getAskConfigFolderPath();
    if (!existsSync(askConfigFolderPath)) {
      mkdirSync(askConfigFolderPath);
    }

    // Check if .ask/ask-states.json exists, if not, build default config.
    const askConfigPath: string = this.$plugin.getAskConfigPath();
    if (!existsSync(askConfigPath)) {
      const defaultConfig: FileObject = _get(defaultFiles, '[".ask/"]');
      FileBuilder.buildDirectory(defaultConfig, askConfigFolderPath);
    }

    const askConfigContent: string = readFileSync(askConfigPath, 'utf-8');
    const askConfig = JSON.parse(askConfigContent);
    _set(askConfig, 'profiles.default.skillId', skillId);

    writeFileSync(askConfigPath, JSON.stringify(askConfig, null, 2));
  }
}