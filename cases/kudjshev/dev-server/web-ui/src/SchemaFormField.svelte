<script lang="ts">
	/**
	 * Рекурсивный компонент формы по JSON Schema.
	 * Поддерживает произвольную глубину вложенности: объекты и массивы.
	 */
	import SchemaFormFieldRecursive from './SchemaFormField.svelte';

	type Path = (string | number)[];

	interface Props {
		keyName: string;
		schema: {
			type?: string;
			description?: string;
			default?: unknown;
			properties?: Record<string, unknown>;
			items?: unknown;
			required?: string[];
		};
		value: unknown;
		required?: boolean;
		path: Path;
		onUpdate: (path: Path, value: unknown) => void;
	}

	let { keyName, schema, value, required = false, path, onUpdate }: Props = $props();

	const fieldType = $derived(schema.type || 'string');
	const hasDescription = $derived(
		typeof schema.description === 'string' && schema.description.trim().length > 0
	);
	const itemSchema = $derived(schema.items as typeof schema | undefined);
	const isObjectItem = $derived(itemSchema?.type === 'object' && itemSchema?.properties);
	const isArrayOfStrings = $derived(itemSchema?.type === 'string');
	const isArrayOfNumbers = $derived(itemSchema?.type === 'number' || itemSchema?.type === 'integer');

	function setPath(path: Path, value: unknown) {
		onUpdate(path, value);
	}
</script>

{#if fieldType === 'object' && schema.properties}
	<div class="form-field form-field-nested">
		<div class="form-field-header">
			<span>
				{keyName}
				{#if required}
					<span class="required">*</span>
				{/if}
			</span>
			{#if hasDescription}
				<p class="field-hint">{schema.description}</p>
			{/if}
		</div>
		<div class="nested-object-container">
			{#each Object.entries(schema.properties) as [nestedKey, nestedProp]}
				{@const nestedSchema = nestedProp as Props['schema']}
				{@const nestedRequired = schema.required?.includes(nestedKey) ?? false}
				{@const nestedValue = (value as Record<string, unknown>)?.[nestedKey]}
				<SchemaFormFieldRecursive
					keyName={nestedKey}
					schema={nestedSchema}
					value={nestedValue}
					required={nestedRequired}
					path={[...path, nestedKey]}
					onUpdate={onUpdate}
				/>
			{/each}
		</div>
	</div>

{:else if fieldType === 'array'}
	<div class="form-field form-field-array">
		<div class="form-field-header">
			<span>
				{keyName}
				{#if required}
					<span class="required">*</span>
				{/if}
			</span>
			{#if hasDescription}
				<p class="field-hint">{schema.description}</p>
			{/if}
		</div>
		<div class="array-container">
			{#each (Array.isArray(value) ? value : []) as item, index}
				{#if isObjectItem && itemSchema?.properties}
					<div class="array-item-object">
						<div class="array-item-header">
							<span>Элемент {index + 1}</span>
							<button
								type="button"
								class="array-item-remove"
								onclick={() => {
									const arr = Array.isArray(value) ? [...value] : [];
									arr.splice(index, 1);
									setPath(path, arr);
								}}
							>
								Удалить
							</button>
						</div>
						<div class="nested-object-container">
							{#each Object.entries(itemSchema.properties) as [itemKey, itemProp]}
								{@const itemPropSchema = itemProp as Props['schema']}
								{@const itemValue = (item as Record<string, unknown>)?.[itemKey]}
								<SchemaFormFieldRecursive
									keyName={itemKey}
									schema={itemPropSchema}
									value={itemValue}
									required={itemSchema.required?.includes(itemKey) ?? false}
									path={[...path, index, itemKey]}
									onUpdate={onUpdate}
								/>
							{/each}
						</div>
					</div>
				{:else}
					<div class="array-item-simple">
						<input
							type={isArrayOfNumbers ? 'number' : 'text'}
							value={item as string | number ?? ''}
							step={itemSchema?.type === 'integer' ? '1' : 'any'}
							oninput={(e) => {
								const arr = Array.isArray(value) ? [...value] : [];
								const v = e.currentTarget.value;
								arr[index] = isArrayOfNumbers
									? (itemSchema?.type === 'integer' ? parseInt(v, 10) : parseFloat(v))
									: v;
								if (isArrayOfNumbers && isNaN(arr[index] as number)) {
									arr[index] = undefined;
								}
								setPath(path, arr);
							}}
						/>
						<button
							type="button"
							class="array-item-remove"
							onclick={() => {
								const arr = Array.isArray(value) ? [...value] : [];
								arr.splice(index, 1);
								setPath(path, arr);
							}}
						>
							Удалить
						</button>
					</div>
				{/if}
			{/each}
			<button
				type="button"
				class="array-item-add"
				onclick={() => {
					const arr = Array.isArray(value) ? [...value] : [];
					if (isObjectItem && itemSchema?.properties) {
						const obj: Record<string, unknown> = {};
						for (const k of Object.keys(itemSchema.properties)) {
							obj[k] = undefined;
						}
						arr.push(obj);
					} else {
						arr.push(isArrayOfNumbers ? undefined : '');
					}
					setPath(path, arr);
				}}
			>
				+ Добавить элемент
			</button>
		</div>
	</div>

{:else}
	<label class="form-field">
		<span>
			{keyName}
			{#if required}
				<span class="required">*</span>
			{/if}
		</span>
		{#if hasDescription}
			<p class="field-hint">{schema.description}</p>
		{/if}
		{#if fieldType === 'boolean'}
			<input
				type="checkbox"
				checked={value === true}
				onchange={(e) => setPath(path, e.currentTarget.checked)}
			/>
		{:else if fieldType === 'number' || fieldType === 'integer'}
			<input
				type="number"
				value={value as number ?? schema.default as number ?? ''}
				step={fieldType === 'integer' ? '1' : 'any'}
				oninput={(e) => {
					const val =
						fieldType === 'integer'
							? parseInt(e.currentTarget.value, 10)
							: parseFloat(e.currentTarget.value);
					setPath(path, isNaN(val) ? undefined : val);
				}}
			/>
		{:else}
			<input
				type="text"
				value={value as string ?? schema.default as string ?? ''}
				oninput={(e) => setPath(path, e.currentTarget.value || undefined)}
			/>
		{/if}
	</label>
{/if}
